package com.taskr.core.Resources;

import javax.persistence.*;
import java.util.Date;

@Entity
public class Task {
    @Id
    @GeneratedValue
    private long id;
    @ManyToOne
    private User ownedBy;
    private String title;
    private String description;
    private long minutesExpectedToComplete;
    private long templateId;
    private Date dueBy;
    private boolean done;

    public Task(User owner, TaskTemplate taskTemplate) {
        this.title = taskTemplate.getName();
        this.ownedBy = owner;
        this.templateId = taskTemplate.getId();
        if (taskTemplate.getDescription() != null){
            this.description = taskTemplate.getDescription();
        }
        if (taskTemplate.getMinutesExpectedToComplete() != 0){
            this.minutesExpectedToComplete = taskTemplate.getMinutesExpectedToComplete();
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

    public long getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(long minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
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
    }
    public boolean isDone() {
        return done;
    }

    public void setDone(boolean trueOrFalse) {
        this.done = trueOrFalse;
    }
}
