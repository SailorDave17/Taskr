package com.taskr.core;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import java.util.Objects;

@Entity
public class Household {
    private String user;
    private String task;

@Id
@GeneratedValue
    private Long id;

    protected Household(){}
    public Household(String user, String task) {
        this.user = user;
        this.task = task;
    }

    public Long getId() {
        return id;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Household household = (Household) o;
        return Objects.equals(user, household.user) &&
                Objects.equals(task, household.task) &&
                Objects.equals(id, household.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(user, task, id);
    }
}
