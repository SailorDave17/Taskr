package com.taskr.core.Resources;

import com.fasterxml.jackson.annotation.JsonBackReference;

import javax.persistence.*;
import java.util.Date;

@Entity
public class Task {
    @Id
    @GeneratedValue
    private long id;
    @JsonBackReference
    @ManyToOne
    private User ownedBy;
    private String title;
    private String description;
    private Integer minutesExpectedToComplete;
    private long templateId;
    private Date dueBy;
    private Boolean done;
    private Integer actualWorkTime = 0;

    public Task(User owner, TaskTemplate taskTemplate) {
        this.title = taskTemplate.getName();
        this.ownedBy = owner;
        this.templateId = taskTemplate.getId();
        if (taskTemplate.getDescription() != null){
            this.description = taskTemplate.getDescription();
        }
        if (taskTemplate.getMinutesExpectedToComplete() != 0){
            this.minutesExpectedToComplete = taskTemplate.getMinutesExpectedToComplete();
            ownedBy.updateUser();
        }
    }

    public Task() {

    }

    public long getId() {
        return id;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Integer getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(Integer minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
        ownedBy.updateUser();
    }

    public Date getDueBy() {
        return dueBy;
    }

    public void setDueBy(Date dueBy) {
        this.dueBy = dueBy;
    }

    public long getTemplateId() {
        return templateId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public User getOwnedBy() {
        return ownedBy;
    }

    public void setOwnedBy(User newOwner) {
        this.ownedBy = newOwner;
        this.ownedBy.updateUser();

    }
    public Boolean isDone() {
        return done;
    }

    public void setDone(Boolean trueOrFalse) {
        this.done = trueOrFalse;
        this.ownedBy.updateUser();
    }

    public Integer getActualWorkTime() {
        return actualWorkTime;
    }

    public void setActualWorkTime(Integer actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }
}
