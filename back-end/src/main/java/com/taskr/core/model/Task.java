package com.taskr.core.model;

import com.fasterxml.jackson.annotation.JsonBackReference;
import org.springframework.transaction.annotation.Transactional;

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
    private Integer minutesExpectedToComplete;
    private String dueBy;
    private Boolean done;
    private Integer actualWorkTime = 0;
    private String description;
    private long templateId;


    public Task(User owner, TaskTemplate taskTemplate) {
        this.title = taskTemplate.getName();
        this.ownedBy = owner;
        this.templateId = taskTemplate.getId();
        if (taskTemplate.getDescription() != null){
            this.description = taskTemplate.getDescription();
        } else this.description = "";
        if (taskTemplate.getMinutesExpectedToComplete() != 0){
            this.minutesExpectedToComplete = taskTemplate.getMinutesExpectedToComplete();
        } else this.minutesExpectedToComplete = 0;
        if (taskTemplate.getActualWorkTime() != 0){
            this.actualWorkTime = taskTemplate.getActualWorkTime();
        } else this.actualWorkTime = 0;
        this.done = false;
        owner.addTask(this);
        System.out.println("I added the task to the owner");
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
    }

    public String getDueBy() {
        return dueBy;
    }

    public void setDueBy(String dueBy) {
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
        ownedBy.deleteTask(this);
        this.ownedBy = newOwner;
        newOwner.addTask(this);
    }
    public Boolean isDone() {
        return done;
    }

    public void setDone(Boolean trueOrFalse) {
        this.done = trueOrFalse;
    }

    public Integer getActualWorkTime() {
        return actualWorkTime;
    }

    public void setActualWorkTime(Integer actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }
}
